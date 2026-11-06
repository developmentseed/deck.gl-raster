/** A URL prefix and the prefixes its files may be read from, itself first. */
export interface MirrorRule {
  prefix: string;
  candidates: string[];
}

/**
 * Parse `RangeReaderOptions.mirrors` into rules, longest prefix first.
 * Throws if a prefix is not a URL that ends in `/`.
 */
export function parseMirrors(
  mirrors: Record<string, readonly string[]>,
): MirrorRule[] {
  return Object.entries(mirrors)
    .map(([prefix, others]) => ({
      prefix: normalizePrefix(prefix),
      candidates: [prefix, ...others].map(normalizePrefix),
    }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
}

/**
 * The prefix as a URL's href, which ends a bare origin with `/`. Throws
 * unless it ends in `/`.
 */
function normalizePrefix(prefix: string): string {
  const { href } = new URL(prefix);
  if (!href.endsWith("/")) {
    throw new Error(`Mirror prefix ${prefix} must end with "/"`);
  }
  return href;
}

/**
 * Where to request `url`: under the first rule whose prefix it starts with,
 * that prefix or one of its mirrors, picked by a hash of `url` so that every
 * request for a file goes to one host; otherwise `url` itself.
 */
export function mirrorUrl(url: URL, rules: readonly MirrorRule[]): URL {
  const { href } = url;
  const rule = rules.find(({ prefix }) => href.startsWith(prefix));
  if (rule === undefined) {
    return url;
  }
  // Picked by the hash's top bits: its lowest bit cancels out when a name
  // repeats in the path, as in USGS's `n37w113/USGS_1_n37w113.tif`.
  const { candidates } = rule;
  const chosen =
    candidates[Math.floor((fnv1a(href) * candidates.length) / 2 ** 32)]!;
  return chosen === rule.prefix
    ? url
    : new URL(chosen + href.slice(rule.prefix.length));
}

/** 32-bit FNV-1a of a string's UTF-16 code units. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
