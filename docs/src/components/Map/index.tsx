import BrowserOnly from "@docusaurus/BrowserOnly";
import type { ReactNode } from "react";

interface MapContainerProps {
  height?: string;
  children: ReactNode;
}

function MapContainer({ height = "500px", children }: MapContainerProps) {
  return (
    <div
      style={{
        height,
        width: "100%",
        borderRadius: "8px",
        overflow: "hidden",
        border: "1px solid var(--ifm-color-emphasis-300)",
        marginBottom: "1rem",
      }}
    >
      {children}
    </div>
  );
}

function MapFallback({ height = "500px" }: { height?: string }) {
  return (
    <MapContainer height={height}>
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--ifm-color-emphasis-100)",
          color: "var(--ifm-color-emphasis-600)",
        }}
      >
        Loading map...
      </div>
    </MapContainer>
  );
}

export interface BrowserMapProps {
  height?: string;
  children: ReactNode;
}

export default function BrowserMap({ height, children }: BrowserMapProps) {
  return (
    <BrowserOnly fallback={<MapFallback height={height} />}>
      {() => <MapContainer height={height}>{children}</MapContainer>}
    </BrowserOnly>
  );
}
