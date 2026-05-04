import { useState } from "react";
import { NLCD_CATEGORY_GROUPS } from "../nlcd/categories.js";

export function Legend() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      style={{
        borderTop: "1px solid #eee",
        marginTop: "12px",
      }}
    >
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          width: "100%",
          padding: "12px 0",
          background: "none",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "14px",
          fontWeight: 500,
        }}
      >
        <span>Legend</span>
        <span
          style={{
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
          }}
        >
          ▼
        </span>
      </button>

      {isExpanded && (
        <>
          <div
            style={{
              maxHeight: "400px",
              overflowY: "auto",
              paddingBottom: "8px",
            }}
          >
            {NLCD_CATEGORY_GROUPS.map((category) => (
              <div key={category.heading} style={{ marginBottom: "12px" }}>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    marginBottom: "6px",
                    color: "#333",
                  }}
                >
                  {category.heading}
                </div>
                {category.items.map((item) => (
                  <div
                    key={item.value}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "8px",
                      marginBottom: "8px",
                      fontSize: "12px",
                    }}
                  >
                    <div
                      style={{
                        width: "16px",
                        height: "16px",
                        borderRadius: "2px",
                        flexShrink: 0,
                        marginTop: "2px",
                        backgroundColor: `rgb(${item.color[0]}, ${item.color[1]}, ${item.color[2]})`,
                        border: "1px solid rgba(0,0,0,0.1)",
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, marginBottom: "2px" }}>
                        {item.label}
                      </div>
                      <div style={{ color: "#666", lineHeight: "1.3" }}>
                        {item.description}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: "12px",
              fontSize: "12px",
            }}
          >
            <a
              href="https://www.mrlc.gov/data/legends/national-land-cover-database-class-legend-and-description"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "#0066cc",
                textDecoration: "none",
              }}
            >
              Classification Reference
            </a>
          </div>
        </>
      )}
    </div>
  );
}
