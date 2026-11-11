import { Box, Text } from "@chakra-ui/react";

/**
 * Notice explaining why no data is shown when zoomed out past the layer's
 * `minZoom`, in the middle of the page.
 */
export function ZoomNotice() {
  return (
    <Box
      position="absolute"
      top="50%"
      left="50%"
      transform="translate(-50%, -50%)"
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
        Zoom in to see the data
      </Text>
      <Text fontSize="xs" color="gray.500">
        Data does not have multiscales, so we prevent it from loading when
        zoomed out too far.
      </Text>
    </Box>
  );
}
