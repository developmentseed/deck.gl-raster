import { Portal, Text, Tooltip } from "@chakra-ui/react";
import { CollecticonCircleQuestion } from "@devseed-ui/collecticons-chakra";
import type { ReactNode } from "react";

export interface HelpTooltipProps {
  /** Tooltip body content. */
  children: ReactNode;
  /**
   * Accessible label for the trigger button. Defaults to `"More information"`.
   */
  label?: string;
}

/**
 * A small "?" icon button that reveals help text on hover/focus — built on
 * Chakra v3's `Tooltip`. Consolidates the bespoke `InfoTooltip` / `HelpIcon`
 * widgets used by several examples.
 */
export function HelpTooltip({
  children,
  label = "More information",
}: HelpTooltipProps) {
  return (
    <Tooltip.Root openDelay={100} closeDelay={100} positioning={{ gutter: 6 }}>
      <Tooltip.Trigger
        type="button"
        aria-label={label}
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        verticalAlign="middle"
        bg="transparent"
        border="none"
        p="0"
        m="0"
        cursor="help"
        color="gray.500"
        fontSize="sm"
        _hover={{ color: "gray.700" }}
      >
        <CollecticonCircleQuestion />
      </Tooltip.Trigger>
      <Portal>
        <Tooltip.Positioner>
          <Tooltip.Content
            maxWidth="260px"
            bg="gray.800"
            color="white"
            px="2.5"
            py="2"
            borderRadius="md"
            boxShadow="0 2px 8px rgba(0, 0, 0, 0.25)"
          >
            <Text fontSize="xs" lineHeight="1.45">
              {children}
            </Text>
          </Tooltip.Content>
        </Tooltip.Positioner>
      </Portal>
    </Tooltip.Root>
  );
}
