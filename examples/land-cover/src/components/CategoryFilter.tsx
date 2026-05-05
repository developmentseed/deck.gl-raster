import { useState } from "react";
import type { NlcdCategoryGroup } from "../nlcd/categories.js";
import { NLCD_CATEGORY_GROUPS } from "../nlcd/categories.js";

/** Props for {@link CategoryFilter}. */
export interface CategoryFilterProps {
  /** Set of currently-selected NLCD category codes. */
  selected: Set<number>;
  /** Called when the selection changes. Receives a fresh Set. */
  onChange: (next: Set<number>) => void;
}

/**
 * Nested checkbox tree for toggling NLCD category visibility.
 *
 * Each heading has its own checkbox that toggles every leaf below it;
 * the heading checkbox shows an indeterminate state when its leaves are
 * a partial selection.
 */
export function CategoryFilter({ selected, onChange }: CategoryFilterProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const setSelectedFor = (codes: number[], shouldSelect: boolean) => {
    const next = new Set(selected);
    for (const code of codes) {
      if (shouldSelect) {
        next.add(code);
      } else {
        next.delete(code);
      }
    }
    onChange(next);
  };

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
        <span>Categories</span>
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
            {NLCD_CATEGORY_GROUPS.map((group) => (
              <CategoryGroupBlock
                key={group.heading}
                group={group}
                selected={selected}
                onSelectedChange={setSelectedFor}
              />
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

interface CategoryGroupBlockProps {
  group: NlcdCategoryGroup;
  selected: Set<number>;
  onSelectedChange: (codes: number[], shouldSelect: boolean) => void;
}

function CategoryGroupBlock({
  group,
  selected,
  onSelectedChange,
}: CategoryGroupBlockProps) {
  const groupCodes = group.items.map((item) => item.value);
  const selectedCount = groupCodes.filter((code) => selected.has(code)).length;
  const allSelected = selectedCount === groupCodes.length;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <div style={{ marginBottom: "12px" }}>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "13px",
          fontWeight: 600,
          marginBottom: "6px",
          cursor: "pointer",
          color: "#333",
        }}
      >
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => {
            if (el) {
              el.indeterminate = someSelected;
            }
          }}
          onChange={(e) => onSelectedChange(groupCodes, e.target.checked)}
          style={{ cursor: "pointer" }}
        />
        <span>{group.heading}</span>
      </label>

      {group.items.map((item) => (
        <label
          key={item.value}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "8px",
            marginLeft: "24px",
            marginBottom: "8px",
            fontSize: "12px",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={selected.has(item.value)}
            onChange={(e) => onSelectedChange([item.value], e.target.checked)}
            style={{ marginTop: "3px", cursor: "pointer" }}
          />
          <span
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
        </label>
      ))}
    </div>
  );
}
