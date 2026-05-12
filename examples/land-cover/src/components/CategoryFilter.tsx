import { Box, Checkbox, chakra, Stack, Text } from "@chakra-ui/react";
import { ExternalLink } from "deck.gl-raster-examples-shared";
import { useState } from "react";
import type { NlcdCategoryGroup } from "../nlcd/categories.js";
import { ALL_NLCD_CODES, NLCD_CATEGORY_GROUPS } from "../nlcd/categories.js";

/** Props for {@link CategoryFilter}. */
export interface CategoryFilterProps {
  /** Set of currently-selected NLCD category codes. */
  selected: Set<number>;
  /** Called when the selection changes. Receives a fresh Set. */
  onChange: (next: Set<number>) => void;
}

/** Tri-state checkbox value for `selectedCount` of `total` leaves checked. */
function checkedState(
  selectedCount: number,
  total: number,
): boolean | "indeterminate" {
  if (selectedCount === 0) {
    return false;
  }
  if (selectedCount === total) {
    return true;
  }
  return "indeterminate";
}

/** The rotating `▼` chevron used in expand/collapse buttons. */
function Chevron({
  open,
  fontSize = "xs",
}: {
  open: boolean;
  fontSize?: string;
}) {
  return (
    <chakra.span
      fontSize={fontSize}
      color="gray.500"
      transition="transform 0.2s"
      transform={open ? "rotate(0deg)" : "rotate(-90deg)"}
    >
      ▼
    </chakra.span>
  );
}

/**
 * Nested checkbox tree for toggling NLCD category visibility.
 *
 * - A master "All categories" checkbox toggles every leaf, with an
 *   indeterminate state when the selection is partial.
 * - Each heading has its own checkbox that toggles every leaf below it,
 *   also with an indeterminate state when its leaves are partial; clicking
 *   the heading text expands/collapses that group.
 * - The whole "Categories" bar expands/collapses the filter.
 */
export function CategoryFilter({ selected, onChange }: CategoryFilterProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedHeadings, setExpandedHeadings] = useState<Set<string>>(
    () => new Set(),
  );

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

  const toggleHeadingExpanded = (heading: string) => {
    const next = new Set(expandedHeadings);
    if (next.has(heading)) {
      next.delete(heading);
    } else {
      next.add(heading);
    }
    setExpandedHeadings(next);
  };

  const allSelectedCount = ALL_NLCD_CODES.filter((code) =>
    selected.has(code),
  ).length;

  return (
    <Box pt="3" borderTopWidth="1px" borderColor="gray.200">
      <chakra.button
        type="button"
        onClick={() => setIsExpanded((x) => !x)}
        aria-expanded={isExpanded}
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        width="100%"
        textAlign="left"
        cursor="pointer"
        userSelect="none"
        bg="transparent"
        border="none"
        p="0"
        m="0"
        fontWeight="medium"
      >
        Categories
        <Chevron open={isExpanded} />
      </chakra.button>

      {isExpanded ? (
        <>
          <Box maxHeight="400px" overflowY="auto" mt="3" pb="2">
            <Checkbox.Root
              display="flex"
              width="full"
              mb="3"
              pb="2"
              borderBottomWidth="1px"
              borderColor="gray.200"
              checked={checkedState(allSelectedCount, ALL_NLCD_CODES.length)}
              onCheckedChange={(d) =>
                setSelectedFor(ALL_NLCD_CODES, d.checked === true)
              }
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label fontWeight="semibold">
                All categories
              </Checkbox.Label>
            </Checkbox.Root>

            <Stack gap="2">
              {NLCD_CATEGORY_GROUPS.map((group) => (
                <CategoryGroupBlock
                  key={group.heading}
                  group={group}
                  selected={selected}
                  onSelectedChange={setSelectedFor}
                  isExpanded={expandedHeadings.has(group.heading)}
                  onToggleExpanded={() => toggleHeadingExpanded(group.heading)}
                />
              ))}
            </Stack>
          </Box>
          <Text mt="3" fontSize="xs">
            <ExternalLink href="https://www.mrlc.gov/data/legends/national-land-cover-database-class-legend-and-description">
              Classification Reference ↗
            </ExternalLink>
          </Text>
        </>
      ) : null}
    </Box>
  );
}

interface CategoryGroupBlockProps {
  group: NlcdCategoryGroup;
  selected: Set<number>;
  onSelectedChange: (codes: number[], shouldSelect: boolean) => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

function CategoryGroupBlock({
  group,
  selected,
  onSelectedChange,
  isExpanded,
  onToggleExpanded,
}: CategoryGroupBlockProps) {
  const groupCodes = group.items.map((item) => item.value);
  const selectedCount = groupCodes.filter((code) => selected.has(code)).length;

  return (
    <Box>
      <Stack direction="row" align="center" gap="2">
        <Checkbox.Root
          flexShrink={0}
          aria-label={`Toggle all ${group.heading} categories`}
          checked={checkedState(selectedCount, groupCodes.length)}
          onCheckedChange={(d) =>
            onSelectedChange(groupCodes, d.checked === true)
          }
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
        </Checkbox.Root>
        <chakra.button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={isExpanded}
          flex="1"
          minW="0"
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          textAlign="left"
          cursor="pointer"
          userSelect="none"
          bg="transparent"
          border="none"
          p="0"
          m="0"
          fontWeight="semibold"
          fontSize="sm"
        >
          {group.heading}
          <Chevron open={isExpanded} fontSize="2xs" />
        </chakra.button>
      </Stack>

      {isExpanded ? (
        <Stack gap="2" mt="2" pl="6">
          {group.items.map((item) => (
            <Checkbox.Root
              key={item.value}
              alignItems="flex-start"
              checked={selected.has(item.value)}
              onCheckedChange={(d) =>
                onSelectedChange([item.value], d.checked === true)
              }
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control mt="0.5" />
              <Box
                as="span"
                flexShrink={0}
                mt="0.5"
                width="3.5"
                height="3.5"
                borderRadius="2px"
                borderWidth="1px"
                borderColor="blackAlpha.200"
                css={{
                  backgroundColor: `rgb(${item.color[0]}, ${item.color[1]}, ${item.color[2]})`,
                }}
              />
              <Checkbox.Label fontSize="xs">
                <Text as="span" display="block" fontWeight="medium">
                  {item.label}
                </Text>
                <Text
                  as="span"
                  display="block"
                  color="gray.500"
                  lineHeight="1.3"
                >
                  {item.description}
                </Text>
              </Checkbox.Label>
            </Checkbox.Root>
          ))}
        </Stack>
      ) : null}
    </Box>
  );
}
