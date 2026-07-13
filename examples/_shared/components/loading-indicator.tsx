import { Box, Spinner, Text } from "@chakra-ui/react";

/**
 * Props for {@link LoadingIndicator}.
 */
export interface LoadingIndicatorProps {
  /** Whether tiles are currently loading. When false, nothing renders. */
  loading: boolean;
  /** Text shown beside the spinner. */
  label?: string;
}

/**
 * A top-center pill that appears while map tiles are loading.
 *
 * Presentational only — the caller owns the `loading` state (see
 * `useTilesLoading`). Self-positions above the map (absolute, high z-index,
 * pointer-events disabled) so it can be dropped in as a sibling of the map and
 * `ControlPanel` without any wrapper.
 */
export function LoadingIndicator({
  loading,
  label = "Loading tiles…",
}: LoadingIndicatorProps) {
  if (!loading) {
    return null;
  }
  return (
    <Box
      position="absolute"
      top="4"
      left="50%"
      transform="translateX(-50%)"
      display="flex"
      alignItems="center"
      gap="2"
      bg="white"
      color="gray.800"
      borderRadius="full"
      boxShadow="0 2px 8px rgba(0, 0, 0, 0.1)"
      px="3"
      py="2"
      pointerEvents="none"
      zIndex={1000}
    >
      <Spinner size="sm" color="gray.600" />
      <Text fontSize="sm">{label}</Text>
    </Box>
  );
}
