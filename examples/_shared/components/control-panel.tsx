import { Box, chakra, Flex, Heading, Link } from "@chakra-ui/react";
import { CollecticonBrandGithub } from "@devseed-ui/collecticons-chakra";
import type { ReactNode } from "react";
import { useState } from "react";
import { ExternalLink } from "./external-link.js";

/** URL of the deck.gl-raster GitHub repository. */
const REPO_URL = "https://github.com/developmentseed/deck.gl-raster";
/** GitHub URL for a path within the repo on the `main` branch. */
const sourceUrl = (path: string) => `${REPO_URL}/tree/main/${path}`;
const DEFAULT_DOCS_URL = "https://developmentseed.org/deck.gl-raster/";

/** Corner of the map a `ControlPanel` anchors to. */
export type ControlPanelPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

const POSITION_STYLES: Record<
  ControlPanelPosition,
  { top?: string; bottom?: string; left?: string; right?: string }
> = {
  "top-left": { top: "20px", left: "20px" },
  "top-right": { top: "20px", right: "20px" },
  "bottom-left": { bottom: "20px", left: "20px" },
  "bottom-right": { bottom: "20px", right: "20px" },
};

export interface ControlPanelProps {
  /** Heading shown in the panel header. */
  title: ReactNode;
  /** Corner to anchor to. Defaults to `"top-left"`. */
  position?: ControlPanelPosition;
  /** Whether the body starts expanded. Defaults to `true`. */
  defaultOpen?: boolean;
  /** Panel width (any CSS length / Chakra size). Defaults to `"350px"`. */
  width?: string;
  /**
   * Documentation URL for the footer "Documentation ↗" link. Defaults to the
   * deck.gl-raster docs site.
   */
  docsHref?: string;
  /**
   * Repo-relative path of the example (e.g. `"examples/cog-basic"`). When set,
   * the footer shows a "View source ↗" link to that path on the `main` branch.
   */
  sourcePath?: string;
  /** Panel body content. */
  children: ReactNode;
}

/**
 * Floating, collapsible control panel anchored to a corner of the map.
 *
 * Self-positioning (`position: absolute`, high `z-index`, `pointerEvents: auto`)
 * — does not need a `UIOverlay` wrapper unless an example stacks several
 * overlay widgets. Manages its own open/closed state. Renders a footer with
 * documentation / source / repository links.
 */
export function ControlPanel({
  title,
  position = "top-left",
  defaultOpen = true,
  width = "350px",
  docsHref = DEFAULT_DOCS_URL,
  sourcePath,
  children,
}: ControlPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Box
      position="absolute"
      {...POSITION_STYLES[position]}
      width={width}
      maxHeight="calc(100% - 40px)"
      overflowY="auto"
      bg="white"
      color="gray.800"
      borderRadius="lg"
      boxShadow="0 2px 8px rgba(0, 0, 0, 0.1)"
      p="4"
      pointerEvents="auto"
      zIndex={1000}
    >
      <chakra.button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
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
      >
        <Heading as="h2" size="md">
          {title}
        </Heading>
        <chakra.span
          fontSize="xs"
          transition="transform 0.2s"
          transform={open ? "rotate(0deg)" : "rotate(-90deg)"}
        >
          ▼
        </chakra.span>
      </chakra.button>
      {open ? (
        <Box mt="3" fontSize="sm">
          {children}
          <Flex
            mt="3"
            pt="2"
            borderTopWidth="1px"
            borderColor="gray.200"
            alignItems="center"
            justifyContent="space-between"
            gap="3"
            fontSize="xs"
          >
            <Flex gap="3" wrap="wrap" alignItems="center">
              <ExternalLink href={docsHref}>Documentation ↗</ExternalLink>
              {sourcePath ? (
                <ExternalLink href={sourceUrl(sourcePath)}>
                  View source ↗
                </ExternalLink>
              ) : null}
            </Flex>
            <Link
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="deck.gl-raster on GitHub"
              color="gray.600"
              _hover={{ color: "gray.900" }}
            >
              <CollecticonBrandGithub />
            </Link>
          </Flex>
        </Box>
      ) : null}
    </Box>
  );
}
