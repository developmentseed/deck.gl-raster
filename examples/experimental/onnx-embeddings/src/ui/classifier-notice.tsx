import { Box, Text } from "@chakra-ui/react";

/**
 * Props for {@link ClassifierNotice}.
 */
export type ClassifierNoticeProps = {
  /** Number of positive examples labeled so far. */
  positives: number;
  /** Number of negative examples labeled so far. */
  negatives: number;
};

/**
 * Notice at the bottom of the map, saying which examples the classifier still
 * needs before it draws anything. Clicks pass through it to the map.
 */
export function ClassifierNotice({
  positives,
  negatives,
}: ClassifierNoticeProps) {
  let title = "Click an example of what you are looking for";
  let detail = "Then shift-click an example of what you are not looking for.";
  if (positives > 0) {
    title = "Now shift-click an example of what you are not looking for";
    detail = "";
  } else if (negatives > 0) {
    title = "Now add an example of what you are looking for";
    detail = "Set the panel to Positive and click the map.";
  }
  return (
    <Box
      position="absolute"
      bottom="10"
      left="50%"
      transform="translateX(-50%)"
      width="max-content"
      maxWidth="min(500px, calc(100% - 40px))"
      bg="white"
      textAlign="center"
      px="4"
      py="3"
      borderRadius="md"
      boxShadow="md"
      pointerEvents="none"
    >
      <Text fontWeight="semibold" color="gray.800">
        {title}
      </Text>
      <Text fontSize="xs" color="gray.500">
        {detail} The classifier draws nothing until it has at least one of each.
      </Text>
    </Box>
  );
}
