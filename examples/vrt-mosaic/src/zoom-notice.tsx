import { Box, Text } from "@chakra-ui/react";

/**
 * Notice explaining why no elevation is drawn when zoomed out past the
 * mosaic's `minZoom`.
 *
 * Pinned bottom-center so it stays clear of the control panel (top-left, full
 * width on narrow screens) and the loading widget (top-right).
 */
export function ZoomNotice() {
  return (
    <Box
      position="absolute"
      bottom="50px"
      left="50%"
      transform="translateX(-50%)"
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
        them at once. Only their footprints are drawn.
      </Text>
    </Box>
  );
}
