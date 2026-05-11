import { Link } from "@chakra-ui/react";
import type { ReactNode } from "react";

export interface ExternalLinkProps {
  /** URL to open in a new tab. */
  href: string;
  children: ReactNode;
}

/** A link that opens in a new tab with `rel="noopener noreferrer"`. */
export function ExternalLink({ href, children }: ExternalLinkProps) {
  return (
    <Link href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </Link>
  );
}

const DEFAULT_DOCS_URL = "https://developmentseed.org/deck.gl-raster/";

export interface DocsLinkProps {
  /** Override the documentation URL. Defaults to the deck.gl-raster docs site. */
  href?: string;
  children?: ReactNode;
}

/** Link to the deck.gl-raster documentation site (`deck.gl-raster Documentation ↗`). */
export function DocsLink({
  href = DEFAULT_DOCS_URL,
  children = "deck.gl-raster Documentation ↗",
}: DocsLinkProps) {
  return <ExternalLink href={href}>{children}</ExternalLink>;
}
