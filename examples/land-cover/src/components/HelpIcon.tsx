import { useState } from "react";

interface HelpIconProps {
  tooltip: string;
}

export function HelpIcon({ tooltip }: HelpIconProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <button
        type="button"
        style={{
          width: "16px",
          height: "16px",
          borderRadius: "50%",
          border: "1.5px solid #666",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "11px",
          fontWeight: "bold",
          color: "#666",
          cursor: "help",
          background: "transparent",
          padding: 0,
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        aria-label="Show debug overlay help"
      >
        ?
      </button>
      {isHovered && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            backgroundColor: "#333",
            color: "white",
            padding: "12px",
            borderRadius: "4px",
            fontSize: "12px",
            whiteSpace: "pre-line",
            width: "300px",
            maxWidth: "600px",
            zIndex: 1000,
            lineHeight: "1.5",
          }}
        >
          {tooltip.trim()}
        </div>
      )}
    </div>
  );
}
