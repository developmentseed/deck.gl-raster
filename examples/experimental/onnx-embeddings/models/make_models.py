# /// script
# # onnxruntime has no wheels for Python 3.15 yet.
# requires-python = ">=3.11,<3.15"
# dependencies = ["numpy", "onnx", "onnxruntime", "onnxscript"]
# ///
"""Build the ONNX models this example runs on each embedding tile.

Usage:

    uv run models/make_models.py public/models

Each model is a Python function that onnxscript translates into an ONNX graph.
After writing the models, the script runs each one with ONNX Runtime and
compares it with NumPy.

A model takes one tile as `embeddings`, the raw AlphaEarth int8 values in the
`[1, 64, height, width]` layout zarrita returns. It dequantizes them and
reshapes them to a `[64, pixels]` matrix. A matrix
product with a `[n, 64]` matrix is then a per-pixel linear map over the band
axis. That matrix is a model input, so the query vector, the centroids or the
classifier weights change per run without a new model. Every output is
`[1, pixels]`, row-major like the tile.
"""

import pathlib
import sys

import numpy as np
import onnx
import onnx.inliner
import onnxruntime as ort
from onnxscript import FLOAT, INT8, script

# The highest opset at which ONNX Runtime Web 1.31 runs `DequantizeLinear` on
# WebGPU.
from onnxscript import opset23 as op

NUM_BANDS = 64
# AlphaEarth's quantization: a stored int8 `v` stands for `(v / 127.5)^2 * sign(v)`.
DEQUANT_SCALE = 1.0 / 127.5
# Score gaps larger than 1 / ARGMAX_GAIN select a single cluster.
ARGMAX_GAIN = 1.0e7
# Shape of one tile as a matrix with a column per pixel.
PIXELS_SHAPE = [NUM_BANDS, -1]

Int8Tile = INT8[1, NUM_BANDS, "height", "width"]
Pixels = FLOAT[NUM_BANDS, "pixels"]
PerPixel = FLOAT[1, "pixels"]


@script(default_opset=op)
def pixels_from_int8(tile: Int8Tile) -> Pixels:
    """Dequantize a tile and flatten it to one column per pixel.

    `DequantizeLinear` turns the int8 values into `v / 127.5` as float32. A
    plain `Cast` would do the same, but ONNX Runtime Web's WebGPU provider
    runs `Cast` from int8 on the CPU. `(v / 127.5)^2 * sign(v)` is then written
    as `x * |x|`, because the provider also runs `Sign` on the CPU.
    """
    scaled = op.DequantizeLinear(tile, DEQUANT_SCALE)
    dequantized = scaled * op.Abs(scaled)
    return op.Reshape(dequantized, PIXELS_SHAPE)


@script(default_opset=op)
def nearest_centroid(
    pixels: Pixels, centroids: FLOAT["clusters", NUM_BANDS], cluster_ids: FLOAT[1, "clusters"]
) -> PerPixel:
    """Index of the centroid with the largest dot product, as a float.

    `ArgMax` returns int64, which the WebGPU provider runs on the CPU. This
    uses float operators only: a one-hot mask of the best score, then a dot
    product with `cluster_ids` (`[0, 1, ..., k - 1]`).
    """
    scores = centroids @ pixels
    gap = scores - op.ReduceMax(scores, [0], keepdims=1)
    is_best = op.Relu(op.Floor(gap * ARGMAX_GAIN + 1.0))
    return cluster_ids @ is_best


@script(default_opset=op)
def similarity(embeddings: Int8Tile, query: FLOAT[1, NUM_BANDS]) -> PerPixel:
    """Dot product of every pixel with `query`: a cosine similarity for unit vectors."""
    similarity = query @ pixels_from_int8(embeddings)
    return similarity


@script(default_opset=op)
def clusters(
    embeddings: Int8Tile, centroids: FLOAT["clusters", NUM_BANDS], cluster_ids: FLOAT[1, "clusters"]
) -> PerPixel:
    """Index of each pixel's nearest centroid."""
    cluster = nearest_centroid(pixels_from_int8(embeddings), centroids, cluster_ids)
    return cluster


@script(default_opset=op)
def classifier(
    embeddings: Int8Tile, weights: FLOAT[1, NUM_BANDS], bias: FLOAT[1]
) -> PerPixel:
    """Logistic regression: `sigmoid(weights . pixel + bias)`."""
    probability = op.Sigmoid(weights @ pixels_from_int8(embeddings) + bias)
    return probability


MODELS = [similarity, clusters, classifier]


def to_model(function) -> onnx.ModelProto:
    """One self-contained ONNX model, with the helper functions inlined."""
    model = onnx.inliner.inline_local_functions(function.to_model_proto())
    used_domains = {node.domain for node in model.graph.node}
    for opset in [o for o in model.opset_import if o.domain not in used_domains]:
        model.opset_import.remove(opset)
    onnx.checker.check_model(model, full_check=True)
    return model


def check(out_dir: pathlib.Path) -> None:
    """Run every model on a random tile and compare it with NumPy."""
    rng = np.random.default_rng(0)
    raw = rng.integers(-127, 128, size=(1, NUM_BANDS, 37, 53), dtype=np.int8)
    value = raw.astype(np.float32)
    scaled = value * np.float32(DEQUANT_SCALE)
    dequantized = scaled * np.abs(scaled)
    pixels = dequantized.reshape(NUM_BANDS, -1)

    k = 5
    query = rng.normal(size=(1, NUM_BANDS)).astype(np.float32)
    centroids = rng.normal(size=(k, NUM_BANDS)).astype(np.float32)
    cluster_ids = np.arange(k, dtype=np.float32).reshape(1, k)
    weights = rng.normal(size=(1, NUM_BANDS)).astype(np.float32)
    bias = np.array([0.25], dtype=np.float32)
    cases = {
        "similarity": ({"query": query}, query @ pixels),
        "clusters": (
            {"centroids": centroids, "cluster_ids": cluster_ids},
            np.argmax(centroids @ pixels, axis=0).astype(np.float32),
        ),
        "classifier": (
            {"weights": weights, "bias": bias},
            1.0 / (1.0 + np.exp(-(weights @ pixels + bias))),
        ),
    }
    for name, (inputs, expected) in cases.items():
        session = ort.InferenceSession(str(out_dir / f"{name}.onnx"))
        (result,) = session.run(None, {"embeddings": raw, **inputs})
        error = np.abs(result.reshape(-1) - expected.reshape(-1)).max()
        if error > 1e-4:
            raise AssertionError(f"{name}: max error {error}")
        print(f"{name}: max error {error:.2e}")


def main() -> None:
    out_dir = pathlib.Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    for function in MODELS:
        path = out_dir / f"{function.name}.onnx"
        path.write_bytes(to_model(function).SerializeToString())
        print(f"{path}: {path.stat().st_size} bytes")
    check(out_dir)


if __name__ == "__main__":
    main()
