import { Box } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * Full-screen, click-through layer for positioning overlay UI above the map.
 *
 * The container itself ignores pointer events; children opt back in
 * (`pointerEvents="auto"`) so the map stays interactive everywhere else.
 * Optional for single-panel examples — `ControlPanel` positions itself.
 */
export function UIOverlay({ children }: { children: ReactNode }) {
  return (
    <Box
      position="absolute"
      top="0"
      left="0"
      width="100%"
      height="100%"
      pointerEvents="none"
      zIndex={1000}
    >
      {children}
    </Box>
  );
}
