/**
 * A fitted logistic regression: `p = sigmoid(weights · x + bias)`.
 */
export type LogisticModel = {
  /** One weight per input dimension. */
  weights: Float32Array;
  /** The intercept. */
  bias: number;
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
  { l2 = 1e-3, iterations = 2000, learningRate = 2 } = {},
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
