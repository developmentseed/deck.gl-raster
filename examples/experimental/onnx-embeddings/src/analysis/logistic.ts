/**
 * A fitted logistic regression: `p = sigmoid(weights · x + bias)`.
 */
export type LogisticModel = {
  /** One weight per input dimension. */
  weights: Float32Array;
  /** The intercept. */
  bias: number;
};

/** Settings of {@link fitLogistic}. */
export type LogisticOptions = {
  /**
   * Step size of each update. The loss is a weighted mean over the samples,
   * so for unit-length vectors any step below `2 / (0.5 + l2)` is stable.
   */
  learningRate: number;
  /** Number of gradient descent updates. */
  iterations: number;
  /** Strength of the L2 penalty on the weights. */
  l2: number;
};

/** The settings {@link fitLogistic} uses when none are given. */
export const DEFAULT_LOGISTIC_OPTIONS: LogisticOptions = {
  learningRate: 2,
  iterations: 2000,
  l2: 1e-3,
};

/**
 * Fit a logistic regression with an L2 penalty by full-batch gradient
 * descent. Each class is weighted equally, whatever its number of samples.
 *
 * @param samples - `n` row-major vectors of length `dims`.
 * @param labels - `n` labels, each 0 or 1. Both classes must be present.
 */
export function fitLogistic(
  samples: Float32Array,
  labels: Uint8Array,
  dims: number,
  { learningRate, iterations, l2 }: LogisticOptions = DEFAULT_LOGISTIC_OPTIONS,
): LogisticModel {
  const n = labels.length;
  if (samples.length !== n * dims) {
    throw new Error(`Expected ${n} samples of ${dims} values`);
  }
  const positives = labels.reduce((sum, label) => sum + label, 0);
  if (positives === 0 || positives === n) {
    throw new Error("Need at least one positive and one negative sample");
  }
  const sampleWeight = (label: number) =>
    0.5 / (label === 1 ? positives : n - positives);

  const weights = new Float64Array(dims);
  let bias = 0;
  const gradient = new Float64Array(dims);
  for (let iteration = 0; iteration < iterations; iteration++) {
    gradient.fill(0);
    let biasGradient = 0;
    for (let i = 0; i < n; i++) {
      let logit = bias;
      for (let d = 0; d < dims; d++) {
        logit += weights[d]! * samples[i * dims + d]!;
      }
      const error = (sigmoid(logit) - labels[i]!) * sampleWeight(labels[i]!);
      for (let d = 0; d < dims; d++) {
        gradient[d]! += error * samples[i * dims + d]!;
      }
      biasGradient += error;
    }
    for (let d = 0; d < dims; d++) {
      weights[d]! -= learningRate * (gradient[d]! + l2 * weights[d]!);
    }
    bias -= learningRate * biasGradient;
  }
  return { weights: Float32Array.from(weights), bias };
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
