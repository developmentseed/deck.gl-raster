import { FIXTURE_FILE, FIXTURE_URL } from "../scene/constants.js";
import type { LoadProgress } from "../scene/load.js";

/** What is loading, from where, for a presenter on a slow network. */
const LOADING_TEXT = `Loading ${FIXTURE_FILE} from ${new URL(FIXTURE_URL).host}...`;

// GitHub's dark palette, like the side panel.
const TRACK = "#30363d";
const FILL = "#58a6ff";

/** Props of {@link Loading}. */
export type LoadingProps = {
  /** How far loading has got, or null before the first read finishes. */
  progress: LoadProgress | null;
};

/** The loading screen: a spinner, what is loading, and a progress bar. */
export function Loading({ progress }: LoadingProps) {
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 1;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Spinner />
        {LOADING_TEXT}
      </div>
      <div
        role="progressbar"
        aria-label="Loading the image"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        style={{
          width: 320,
          maxWidth: "70vw",
          height: 6,
          borderRadius: 3,
          background: TRACK,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${(100 * done) / total}%`,
            height: "100%",
            background: FILL,
            transition: "width 300ms ease-out",
          }}
        />
      </div>
    </div>
  );
}

/** A ring with a turning arc, animated by SVG so it needs no stylesheet. */
function Spinner() {
  return (
    <svg width={26} height={26} viewBox="0 0 26 26" aria-hidden="true">
      <circle
        cx={13}
        cy={13}
        r={10}
        fill="none"
        stroke={TRACK}
        strokeWidth={3}
      />
      <path
        d="M13 3 a10 10 0 0 1 10 10"
        fill="none"
        stroke={FILL}
        strokeWidth={3}
        strokeLinecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 13 13"
          to="360 13 13"
          dur="0.9s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}
