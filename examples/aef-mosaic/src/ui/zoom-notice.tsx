import { Box, Text } from "@chakra-ui/react";

type ZoomNoticeProps = {
  zoom: number;
  minZoom: number;
};

export function ZoomNotice({ zoom, minZoom }: ZoomNoticeProps) {
  if (zoom >= minZoom) {
    return null;
  }

  return (
    <Box
      position="absolute"
      top="20px"
      right="20px"
      bg="white"
      textAlign="center"
      px="4"
      py="3"
      borderRadius="md"
      boxShadow="md"
      maxWidth="300px"
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
