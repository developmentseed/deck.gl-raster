import type { ReactNode } from "react";

interface UIOverlayProps {
  children: ReactNode;
}

export function UIOverlay({ children }: UIOverlayProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 1000,
      }}
    >
      {children}
    </div>
  );
}
