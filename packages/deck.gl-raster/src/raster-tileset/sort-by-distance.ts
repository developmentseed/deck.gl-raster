/**
 * Sort `items` in place by ascending squared Euclidean distance of each
 * item's center from `reference`. Returns the same array reference.
 *
 * `getCenter` is called exactly once per item (O(n) pre-pass) — never from
 * inside the sort comparator. This keeps the per-viewport cost bounded:
 * one center computation per tile plus one sort of precomputed numbers.
 *
 * Equal-distance items retain their original relative order (stable sort
 * per ES2019 `Array.prototype.sort` spec).
 *
 * For `items.length < 2` this is a no-op and `getCenter` is not called.
 *
 * Caller-side short-circuits (e.g. `n <= maxRequests`) should be applied
 * before invoking this helper when they would skip useful work entirely.
 */
export function sortByDistanceFromPoint<T>(
  items: T[],
  opts: {
    getCenter: (item: T) => readonly [number, number];
    reference: readonly [number, number];
  },
): T[] {
  const n = items.length;
  if (n < 2) {
    return items;
  }

  const { getCenter, reference } = opts;
  const rx = reference[0];
  const ry = reference[1];

  const distances = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const center = getCenter(items[i]!);
    const dx = center[0] - rx;
    const dy = center[1] - ry;
    distances[i] = dx * dx + dy * dy;
  }

  const permutation = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    permutation[i] = i;
  }
  permutation.sort((a, b) => distances[a]! - distances[b]!);

  const scratch = items.slice();
  for (let i = 0; i < n; i++) {
    items[i] = scratch[permutation[i]!]!;
  }

  return items;
}
