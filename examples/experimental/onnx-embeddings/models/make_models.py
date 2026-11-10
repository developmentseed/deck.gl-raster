"""Build the ONNX models this example runs on each embedding tile.

Usage:

    uv run --no-project --with onnx --with numpy python models/make_models.py public/models

Add `--with onnxruntime` and pass `--check` to compare each model against a
NumPy reference on random data.

Each model takes one tile as `embeddings` of shape `[1, 64, height, width]`,
the layout zarrita returns, and reshapes it to a `[64, pixels]` matrix. A
`MatMul` with a `[n, 64]` matrix is then a per-pixel linear map over the band
axis. The matrix is a model input, so the query vector, the centroids or the
classifier weights change per run without a new model. Every output is
`[1, pixels]`, row-major like the tile.

A 1 x 1 `Conv` computes the same thing, but ONNX Runtime Web's WebGPU provider
prefers NHWC and wraps it in two transposes of the whole tile.

Every model comes in two variants:

- `*_int8.onnx` takes the raw AlphaEarth int8 values and dequantizes them in
  the graph: `v * |v| / 127.5^2`, the same as `(v / 127.5)^2 * sign(v)`.
- `*_float32.onnx` takes values that are already dequantized.
"""

import pathlib
import sys

import numpy as np

import onnx
from onnx import TensorProto, helper

NUM_BANDS = 64
DEQUANT_SCALE = 1.0 / (127.5 * 127.5)
OPSET = 20
# Multiplier for the float-only argmax: score gaps larger than 1 / ARGMAX_GAIN
# select a single cluster.
ARGMAX_GAIN = 1.0e7


def flatten(dtype: int) -> tuple[list[onnx.NodeProto], list[onnx.TensorProto]]:
    """Nodes that turn `embeddings` into the float `[64, pixels]` matrix `x`."""
    shape = helper.make_tensor("pixels_shape", TensorProto.INT64, [2], [NUM_BANDS, -1])
    if dtype == TensorProto.FLOAT:
        return [helper.make_node("Reshape", ["embeddings", "pixels_shape"], ["x"])], [shape]
    nodes = [
        helper.make_node("Cast", ["embeddings"], ["raw"], to=TensorProto.FLOAT),
        helper.make_node("Abs", ["raw"], ["raw_abs"]),
        helper.make_node("Mul", ["raw", "raw_abs"], ["raw_squared"]),
        helper.make_node("Mul", ["raw_squared", "dequant_scale"], ["dequantized"]),
        helper.make_node("Reshape", ["dequantized", "pixels_shape"], ["x"]),
    ]
    scale = helper.make_tensor("dequant_scale", TensorProto.FLOAT, [], [DEQUANT_SCALE])
    return nodes, [scale, shape]


def build(
    name: str,
    dtype: int,
    nodes: list[onnx.NodeProto],
    inputs: list[onnx.ValueInfoProto],
    output: onnx.ValueInfoProto,
    initializers: list[onnx.TensorProto] | None = None,
) -> onnx.ModelProto:
    """Wrap `nodes` after the flatten step into a checked model."""
    pre_nodes, pre_initializers = flatten(dtype)
    embeddings = helper.make_tensor_value_info(
        "embeddings", dtype, [1, NUM_BANDS, "height", "width"]
    )
    graph = helper.make_graph(
        pre_nodes + nodes,
        name,
        [embeddings, *inputs],
        [output],
        pre_initializers + (initializers or []),
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", OPSET)])
    model.ir_version = 9
    onnx.checker.check_model(model, full_check=True)
    return model


def similarity(dtype: int) -> onnx.ModelProto:
    """Dot product of every pixel with `query`: a cosine similarity for unit vectors."""
    query = helper.make_tensor_value_info("query", TensorProto.FLOAT, [1, NUM_BANDS])
    output = helper.make_tensor_value_info("similarity", TensorProto.FLOAT, [1, "pixels"])
    nodes = [helper.make_node("MatMul", ["query", "x"], ["similarity"])]
    return build("similarity", dtype, nodes, [query], output)


def clusters(dtype: int) -> onnx.ModelProto:
    """Index of the nearest centroid (largest dot product) as a float.

    `ArgMax` outputs int64, which the WebGPU provider runs on the CPU. This
    argmax uses float ops only: a one-hot mask of the best score, then a dot
    product with `cluster_ids` (`[0, 1, ..., k - 1]`).
    """
    centroids = helper.make_tensor_value_info(
        "centroids", TensorProto.FLOAT, ["clusters", NUM_BANDS]
    )
    cluster_ids = helper.make_tensor_value_info("cluster_ids", TensorProto.FLOAT, [1, "clusters"])
    output = helper.make_tensor_value_info("cluster", TensorProto.FLOAT, [1, "pixels"])
    nodes = [
        helper.make_node("MatMul", ["centroids", "x"], ["scores"]),
        helper.make_node("ReduceMax", ["scores", "cluster_axis"], ["best"], keepdims=1),
        helper.make_node("Sub", ["scores", "best"], ["gap"]),
        helper.make_node("Mul", ["gap", "argmax_gain"], ["scaled_gap"]),
        helper.make_node("Add", ["scaled_gap", "one"], ["shifted_gap"]),
        helper.make_node("Floor", ["shifted_gap"], ["floored_gap"]),
        helper.make_node("Relu", ["floored_gap"], ["is_best"]),
        helper.make_node("MatMul", ["cluster_ids", "is_best"], ["cluster"]),
    ]
    initializers = [
        helper.make_tensor("cluster_axis", TensorProto.INT64, [1], [0]),
        helper.make_tensor("argmax_gain", TensorProto.FLOAT, [], [ARGMAX_GAIN]),
        helper.make_tensor("one", TensorProto.FLOAT, [], [1.0]),
    ]
    return build("clusters", dtype, nodes, [centroids, cluster_ids], output, initializers)


def classifier(dtype: int) -> onnx.ModelProto:
    """Logistic regression: `sigmoid(weights . x + bias)` per pixel."""
    weights = helper.make_tensor_value_info("weights", TensorProto.FLOAT, [1, NUM_BANDS])
    bias = helper.make_tensor_value_info("bias", TensorProto.FLOAT, [1])
    output = helper.make_tensor_value_info("probability", TensorProto.FLOAT, [1, "pixels"])
    nodes = [
        helper.make_node("MatMul", ["weights", "x"], ["weighted"]),
        helper.make_node("Add", ["weighted", "bias"], ["logit"]),
        helper.make_node("Sigmoid", ["logit"], ["probability"]),
    ]
    return build("classifier", dtype, nodes, [weights, bias], output)


BUILDERS = {"similarity": similarity, "clusters": clusters, "classifier": classifier}
DTYPES = {"int8": TensorProto.INT8, "float32": TensorProto.FLOAT}


def check(out_dir: pathlib.Path) -> None:
    """Compare every model with a NumPy reference on random int8 tiles."""
    import onnxruntime as ort

    rng = np.random.default_rng(0)
    raw = rng.integers(-127, 128, size=(1, NUM_BANDS, 37, 53), dtype=np.int8)
    raw_float = raw.astype(np.float32)
    x = raw_float * np.abs(raw_float) * np.float32(DEQUANT_SCALE)
    pixels = x[0].reshape(NUM_BANDS, -1)
    k = 5
    feeds = {
        "similarity": {"query": rng.normal(size=(1, NUM_BANDS)).astype(np.float32)},
        "clusters": {
            "centroids": rng.normal(size=(k, NUM_BANDS)).astype(np.float32),
            "cluster_ids": np.arange(k, dtype=np.float32).reshape(1, k),
        },
        "classifier": {
            "weights": rng.normal(size=(1, NUM_BANDS)).astype(np.float32),
            "bias": np.array([0.25], dtype=np.float32),
        },
    }
    expected = {
        "similarity": feeds["similarity"]["query"] @ pixels,
        "clusters": np.argmax(feeds["clusters"]["centroids"] @ pixels, axis=0).astype(np.float32),
        "classifier": 1.0 / (1.0 + np.exp(-(feeds["classifier"]["weights"] @ pixels + 0.25))),
    }
    for name, inputs in feeds.items():
        for label, embeddings in (("int8", raw), ("float32", x)):
            session = ort.InferenceSession(str(out_dir / f"{name}_{label}.onnx"))
            (result,) = session.run(None, {"embeddings": embeddings, **inputs})
            error = np.abs(result.reshape(-1) - expected[name].reshape(-1)).max()
            if error > 1e-4:
                raise AssertionError(f"{name}_{label}: max error {error}")
            print(f"{name}_{label}: max error {error:.2e}")


def main() -> None:
    out_dir = pathlib.Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, builder in BUILDERS.items():
        for label, dtype in DTYPES.items():
            path = out_dir / f"{name}_{label}.onnx"
            path.write_bytes(builder(dtype).SerializeToString())
            print(f"{path}: {path.stat().st_size} bytes")
    if "--check" in sys.argv:
        check(out_dir)


if __name__ == "__main__":
    main()
