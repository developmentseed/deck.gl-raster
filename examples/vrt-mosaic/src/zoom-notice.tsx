import { Box, Text } from "@chakra-ui/react";

/**
 * Notice explaining why no elevation is drawn when zoomed out past the
 * mosaic's `minZoom`.
 *
 * Centered on the map, and lets pointer events through so the map can still
 * be panned and zoomed under it.
 */
export function ZoomNotice() {
  return (
    <Box
      position="absolute"
      top="50%"
      left="50%"
      transform="translate(-50%, -50%)"
      pointerEvents="none"
      width="max-content"
      maxWidth="min(300px, calc(100% - 40px))"
      bg="white"
      textAlign="center"
      px="4"
      py="3"
      borderRadius="md"
      boxShadow="md"
    >
      <Text fontWeight="semibold" color="gray.800">
        Zoom in to see the elevation
      </Text>
      <Text fontSize="xs" color="gray.500">
        Each file is a 1° tile, so this far out a view would open hundreds of
        them at once.
      </Text>
    </Box>
  );
}
