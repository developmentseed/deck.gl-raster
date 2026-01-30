/**
 * @module cache
 *
 * Simple in-memory cache for consolidated metadata.
 * Prevents duplicate network requests when metadata is needed
 * in multiple places (parsing, coordinate loading, etc).
 */

import type { ZarrV2ConsolidatedMetadata, ZarrV3GroupMetadata } from "./types";

type CachedMetadata = ZarrV2ConsolidatedMetadata | ZarrV3GroupMetadata;

// Module-level cache keyed by normalized source URL
const metadataCache = new Map<string, CachedMetadata>();

/**
 * Normalize a source URL for cache key purposes.
 */
function normalizeUrl(source: string): string {
  // Remove trailing slash for consistency
  return source.replace(/\/$/, "");
}

/**
 * Get cached metadata for a source URL.
 */
export function getCachedMetadata(source: string): CachedMetadata | undefined {
  return metadataCache.get(normalizeUrl(source));
}

/**
 * Store metadata in the cache.
 */
export function setCachedMetadata(
  source: string,
  metadata: CachedMetadata,
): void {
  metadataCache.set(normalizeUrl(source), metadata);
}

/**
 * Check if metadata is cached for a source URL.
 */
export function hasCachedMetadata(source: string): boolean {
  return metadataCache.has(normalizeUrl(source));
}

/**
 * Clear the metadata cache (useful for testing).
 */
export function clearMetadataCache(): void {
  metadataCache.clear();
}
