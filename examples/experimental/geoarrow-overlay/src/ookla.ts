import * as arrow from "apache-arrow";
import initParquetWasm, { ParquetFile } from "parquet-wasm/esm";
import parquetWasmUrl from "parquet-wasm/esm/parquet_wasm_bg.wasm?url";
import { speedColors } from "./speed-colors.js";

/**
 * Ookla's Q2 2026 mobile network performance tiles: Ookla's own Parquet file
 * on its public S3 bucket, read as-is.
 */
export const OOKLA_URL =
  "https://ookla-open-data.s3.us-west-2.amazonaws.com/parquet/performance/type=mobile/year=2026/quarter=2/2026-04-01_performance_mobile_tiles.parquet";

/**
 * The only columns we read. `tile_x`/`tile_y` are each tile's centroid; the
 * file's much larger WKT `tile` and `quadkey` columns are never fetched.
 */
const COLUMNS = ["tile_x", "tile_y", "avg_d_kbps"];

/**
 * Rows per Arrow record batch. Larger than any row group, so each row group
 * arrives as a single batch (and becomes a single deck.gl layer).
 */
const BATCH_SIZE = 2 ** 21;

/** Alpha for every point. */
const POINT_ALPHA = 220;

/** Summary of the Parquet file, from its footer metadata. */
export interface OoklaFileInfo {
  /** Total rows (tiles) in the file. */
  numRows: number;
  /** Compressed bytes of the columns we read. */
  bytesToRead: number;
  /** Compressed bytes of every column in the file. */
  totalBytes: number;
  /** Number of columns we read. */
  numColumnsRead: number;
  /** Number of columns in the file. */
  numColumns: number;
}

/** One Parquet row group, ready to hand to a `GeoArrowScatterplotLayer`. */
export interface SpeedBatch {
  /** The row group as an Arrow record batch with the columns we read. */
  batch: arrow.RecordBatch;
  /**
   * GeoArrow point geometry in the "separated" layout (`struct<x, y>`), built
   * from the `tile_x` and `tile_y` columns without copying them.
   */
  positions: arrow.Data<arrow.Struct<{ x: arrow.Float64; y: arrow.Float64 }>>;
  /** RGBA color per point, from its download speed. */
  colors: arrow.Data<arrow.FixedSizeList<arrow.Uint8>>;
  /** Download speed per point in Mbps, for `DataFilterExtension`. */
  downloadMbps: arrow.Data<arrow.Float32>;
}

/** Options for {@link loadOokla}. */
export interface LoadOoklaOptions {
  /** URL of an Ookla performance tiles Parquet file. */
  url: string;
  /** Stops reading when aborted; no callbacks fire afterwards. */
  signal: AbortSignal;
  /** Called once with the file summary, before any rows are read. */
  onFileInfo: (info: OoklaFileInfo) => void;
  /** Called once per row group as it finishes downloading and decoding. */
  onBatch: (batch: SpeedBatch) => void;
}

let wasmReady: Promise<unknown> | null = null;

/** Initialize the parquet-wasm module once per page. */
function initWasm(): Promise<unknown> {
  wasmReady ??= initParquetWasm({ module_or_path: parquetWasmUrl });
  return wasmReady;
}

/**
 * Stream an Ookla Parquet file with parquet-wasm, using HTTP range requests
 * to fetch only the footer and the columns in {@link COLUMNS}.
 */
export async function loadOokla({
  url,
  signal,
  onFileInfo,
  onBatch,
}: LoadOoklaOptions): Promise<void> {
  await initWasm();
  const file = await ParquetFile.fromUrl(url);
  if (signal.aborted) {
    return;
  }
  onFileInfo(summarize(file));

  const stream = (await file.stream({
    columns: COLUMNS,
    batchSize: BATCH_SIZE,
    concurrency: 4,
  })) as ReadableStream<{ intoIPCStream(): Uint8Array }>;
  const reader = stream.getReader();
  const cancel = () => {
    reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) {
        return;
      }
      // Copy the batch out of WebAssembly memory as Arrow IPC and parse it
      // with apache-arrow JS.
      const table = arrow.tableFromIPC(value.intoIPCStream());
      for (const batch of table.batches) {
        onBatch(toSpeedBatch(batch));
      }
    }
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

/** Sum compressed column sizes from the Parquet footer. */
function summarize(file: ParquetFile): OoklaFileInfo {
  const metadata = file.metadata();
  let numRows = 0;
  let bytesToRead = 0;
  let totalBytes = 0;
  let numColumns = 0;
  for (const rowGroup of metadata.rowGroups()) {
    numRows += rowGroup.numRows();
    numColumns = rowGroup.numColumns();
    for (const column of rowGroup.columns()) {
      const size = column.compressedSize();
      totalBytes += size;
      if (COLUMNS.includes(column.columnPath().join("."))) {
        bytesToRead += size;
      }
    }
  }
  return {
    numRows,
    bytesToRead,
    totalBytes,
    numColumnsRead: COLUMNS.length,
    numColumns,
  };
}

/** Derive the geometry, color, and filter columns for one record batch. */
function toSpeedBatch(batch: arrow.RecordBatch): SpeedBatch {
  const numRows = batch.numRows;
  const x = getColumnData<arrow.Float64>(batch, "tile_x");
  const y = getColumnData<arrow.Float64>(batch, "tile_y");

  // A GeoArrow "separated" point array is a struct of x and y coordinate
  // arrays, so the two Float64 columns become its children as-is.
  const positions = arrow.makeData({
    type: new arrow.Struct<{ x: arrow.Float64; y: arrow.Float64 }>([
      new arrow.Field("x", new arrow.Float64(), false),
      new arrow.Field("y", new arrow.Float64(), false),
    ]),
    length: numRows,
    nullCount: 0,
    children: [x, y],
  });

  const downloadKbps = getColumnData<arrow.Int64>(batch, "avg_d_kbps").values;
  const mbps = new Float32Array(numRows);
  for (let i = 0; i < numRows; i++) {
    mbps[i] = Number(downloadKbps[i]) / 1000;
  }

  const colors = arrow.makeData({
    type: new arrow.FixedSizeList(
      4,
      new arrow.Field("rgba", new arrow.Uint8()),
    ),
    length: numRows,
    nullCount: 0,
    child: arrow.makeData({
      type: new arrow.Uint8(),
      length: numRows * 4,
      data: speedColors(mbps, POINT_ALPHA),
    }),
  });

  const downloadMbps = arrow.makeData({
    type: new arrow.Float32(),
    length: numRows,
    data: mbps,
  });

  return { batch, positions, colors, downloadMbps };
}

/** The single `Data` chunk backing a record batch column. */
function getColumnData<T extends arrow.DataType>(
  batch: arrow.RecordBatch,
  name: string,
): arrow.Data<T> {
  const column = batch.getChild(name);
  if (column === null) {
    throw new Error(`Column "${name}" missing from Parquet record batch`);
  }
  return column.data[0] as arrow.Data<T>;
}
