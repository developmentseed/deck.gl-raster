import { Box } from "@chakra-ui/react";

export interface ColormapPreviewProps {
  /** URL of the colormap sprite PNG (one colormap per 1px row). */
  spriteUrl: string;
  /** Total number of rows in the sprite. */
  rowCount: number;
  /** Zero-based row index of the colormap to display. */
  rowIndex: number;
  /**
   * Whether to mirror the strip horizontally (a reversed colormap). Defaults to
   * `false`.
   */
  reversed?: boolean;
  /** Human-readable colormap name, used for the strip's `aria-label`. */
  label: string;
  /**
   * Displayed strip height in px (the 1px source row is stretched). Defaults to
   * `14`.
   */
  height?: number;
}

/**
 * A preview strip for one colormap out of a vertically-stacked sprite PNG.
 * Sprite metadata is passed in so this stays decoupled from
 * `@developmentseed/deck.gl-raster` — callers pass the package's
 * `colormaps.png` URL and `Object.keys(COLORMAP_INDEX).length`.
 */
export function ColormapPreview({
  spriteUrl,
  rowCount,
  rowIndex,
  reversed = false,
  label,
  height = 14,
}: ColormapPreviewProps) {
  return (
    <Box
      role="img"
      aria-label={`Colormap preview: ${label}`}
      width="full"
      height={`${height}px`}
      borderRadius="sm"
      borderWidth="1px"
      borderColor="gray.200"
      backgroundImage={`url(${spriteUrl})`}
      backgroundRepeat="no-repeat"
      backgroundSize={`100% ${rowCount * height}px`}
      backgroundPosition={`0 -${rowIndex * height}px`}
      transform={reversed ? "scaleX(-1)" : undefined}
      css={{ imageRendering: "pixelated" }}
    />
  );
}
