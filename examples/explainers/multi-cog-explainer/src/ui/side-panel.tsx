import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";

/** Width of the open panel, in CSS px. */
const PANEL_WIDTH = 320;
/** Width of the collapsed panel's rail, in CSS px. */
const RAIL_WIDTH = 44;
/** Screens where the open panel floats over the slide instead of beside it. */
const NARROW_QUERY = "(max-width: 700px)";

const REPO_URL = "https://github.com/developmentseed/deck.gl-raster";
const SOURCE_URL = `${REPO_URL}/tree/main/examples/explainers/multi-cog-explainer`;
const DOCS_URL = "https://developmentseed.org/deck.gl-raster/";
const LAYER_DOCS_URL =
  "https://developmentseed.org/deck.gl-raster/api/deck-gl-geotiff/classes/MultiCOGLayer/";
const REPROJECTION_EXPLAINER_URL =
  "https://developmentseed.org/deck.gl-raster/examples/reprojection-explainer/";
const DEVSEED_URL = "https://developmentseed.org/";
const SENTINEL_COGS_URL = "https://registry.opendata.aws/sentinel-2-l2a-cogs/";

// GitHub's dark palette, like the slide.
const BACKGROUND = "#161b22";
const BORDER = "#30363d";
const TEXT = "#e6edf3";
const MUTED = "#8b949e";
const LINK = "#58a6ff";

/** Props of {@link SidePanel}. */
export type SidePanelProps = {
  /** Whether the panel is open. Closed, it collapses to a narrow rail. */
  open: boolean;
  /** Called to open or collapse the panel. */
  onOpenChange: (open: boolean) => void;
};

/**
 * The keys and links, in a sidebar beside the slide so they never cover it.
 * It starts collapsed to a rail that opens it (as does P).
 */
export function SidePanel({ open, onOpenChange }: SidePanelProps) {
  const narrow = useMediaQuery(NARROW_QUERY);
  return (
    <aside
      aria-label="About"
      style={{
        flex: "none",
        boxSizing: "border-box",
        width: open ? PANEL_WIDTH : RAIL_WIDTH,
        maxWidth: "90vw",
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
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
              MultiCOGLayer explainer
            </h2>
            <button
              type="button"
              aria-label="Hide the side panel"
              aria-expanded={true}
              title="Hide (P)"
              onClick={() => onOpenChange(false)}
              style={ICON_BUTTON_STYLE}
            >
              «
            </button>
          </header>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
            <Section title="Keys">
              <KeyList />
            </Section>
            <Section title="See also">
              <p style={{ margin: "0 0 8px", lineHeight: 1.5 }}>
                <FooterLink href={LAYER_DOCS_URL}>
                  MultiCOGLayer docs ↗
                </FooterLink>
              </p>
              <p style={{ margin: 0, lineHeight: 1.5 }}>
                <FooterLink href={REPROJECTION_EXPLAINER_URL}>
                  Reprojection explainer ↗
                </FooterLink>
              </p>
            </Section>
            <Section title="Data">
              <p style={{ margin: 0, lineHeight: 1.5, color: MUTED }}>
                Sentinel-2 L2A scene 18FXJ over Torres del Paine, Chile,
                2026-04-06, read live from the{" "}
                <FooterLink href={SENTINEL_COGS_URL}>
                  Sentinel-2 COGs on AWS ↗
                </FooterLink>
                . Contains modified Copernicus Sentinel data 2026.
              </p>
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
          aria-label="Show the side panel"
          aria-expanded={false}
          title="Keys and links (P)"
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
          <span style={{ fontSize: 18 }}>»</span>
          {narrow ? null : <Key>P</Key>}
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
        <Key>1</Key>-<Key>9</Key>
      </>,
      "Jump to a step",
    ],
    [<Key key="d">D</Key>, "Show or hide descriptions"],
    [<Key key="p">P</Key>, "Show or hide this panel"],
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
