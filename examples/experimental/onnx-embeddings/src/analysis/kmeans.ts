/**
 * Options for {@link sphericalKMeans}.
 */
export type KMeansOptions = {
  /** Number of clusters. */
  k: number;
  /** Number of Lloyd iterations after the k-means++ seeding. */
  iterations: number;
  /** Seed for the deterministic random number generator. */
  seed: number;
};

/**
 * Spherical k-means on unit vectors: assign each sample to the centroid with
 * the largest dot product, then set each centroid to the normalized mean of
 * its samples. Seeded with k-means++ on the cosine distance.
 *
 * @param samples - `n` row-major vectors of length `dims`.
 * @returns `k` row-major unit centroids of length `dims`.
 */
export function sphericalKMeans(
  samples: Float32Array,
  dims: number,
  options: KMeansOptions,
): Float32Array {
  const { k, iterations, seed } = options;
  const n = samples.length / dims;
  if (!Number.isInteger(n) || n < k) {
    throw new Error(`Need at least k = ${k} samples, got ${n}`);
  }
  const random = mulberry32(seed);
  const centroids = seedPlusPlus(samples, dims, k, random);
  const assignment = new Int32Array(n);
  const sums = new Float64Array(k * dims);
  for (let iteration = 0; iteration < iterations; iteration++) {
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const best = nearest(samples, i, centroids, dims, k);
      if (best !== assignment[i]) {
        changed++;
        assignment[i] = best;
      }
    }
    if (iteration > 0 && changed === 0) {
      break;
    }
    sums.fill(0);
    for (let i = 0; i < n; i++) {
      const base = assignment[i]! * dims;
      for (let d = 0; d < dims; d++) {
        sums[base + d]! += samples[i * dims + d]!;
      }
    }
    for (let c = 0; c < k; c++) {
      let norm = 0;
      for (let d = 0; d < dims; d++) {
        norm += sums[c * dims + d]! ** 2;
      }
      // An empty cluster keeps its previous centroid
      if (norm === 0) {
        continue;
      }
      const scale = 1 / Math.sqrt(norm);
      for (let d = 0; d < dims; d++) {
        centroids[c * dims + d] = sums[c * dims + d]! * scale;
      }
    }
  }
  return centroids;
}

/** Index of the centroid with the largest dot product with sample `i`. */
function nearest(
  samples: Float32Array,
  i: number,
  centroids: Float32Array,
  dims: number,
  k: number,
): number {
  let best = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let c = 0; c < k; c++) {
    let score = 0;
    for (let d = 0; d < dims; d++) {
      score += samples[i * dims + d]! * centroids[c * dims + d]!;
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** k-means++ seeding with the cosine distance `1 - a · b`. */
function seedPlusPlus(
  samples: Float32Array,
  dims: number,
  k: number,
  random: () => number,
): Float32Array {
  const n = samples.length / dims;
  const centroids = new Float32Array(k * dims);
  const distance = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  let pick = Math.floor(random() * n);
  for (let c = 0; c < k; c++) {
    centroids.set(samples.subarray(pick * dims, (pick + 1) * dims), c * dims);
    let total = 0;
    for (let i = 0; i < n; i++) {
      let dot = 0;
      for (let d = 0; d < dims; d++) {
        dot += samples[i * dims + d]! * centroids[c * dims + d]!;
      }
      const next = Math.max(0, 1 - dot);
      if (next < distance[i]!) {
        distance[i] = next;
      }
      total += distance[i]! ** 2;
    }
    let target = random() * total;
    for (let i = 0; i < n; i++) {
      target -= distance[i]! ** 2;
      if (target <= 0) {
        pick = i;
        break;
      }
    }
  }
  return centroids;
}

/** A small seeded PRNG returning floats in `[0, 1)`. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
