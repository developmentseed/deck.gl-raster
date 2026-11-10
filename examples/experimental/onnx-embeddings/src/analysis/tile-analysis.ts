import type { AefTileData } from "../aef/get-tile-data.js";
import { destroyTile } from "../aef/get-tile-data.js";
import type {
  AnalysisTask,
  InputPath,
  ModelName,
} from "../onnx/model-runner.js";
import { ModelRunner } from "../onnx/model-runner.js";
import { loadOrt } from "../onnx/runtime.js";

/** Timing of one pass over the resident tiles. */
export type PassStats = {
  /** The model that ran. */
  model: ModelName;
  /** How embeddings reached the model. */
  inputPath: InputPath;
  /** Number of tiles the pass ran the model on. */
  tiles: number;
  /** Wall time from the start of the pass to the texture writes. */
  ms: number;
  /** Sum of the per-tile model run times. */
  runMs: number;
};

/** What the UI shows about the analysis. */
export type AnalysisStatus = {
  /**
   * Bumped whenever tile textures change. Pass it in
   * `updateTriggers.renderTile` so deck.gl draws the new values.
   */
  renderVersion: number;
  /** Whether ONNX Runtime is loading or a pass is running. */
  busy: boolean;
  /** The last completed pass. */
  lastPass: PassStats | null;
  /** Time to load ONNX Runtime and create the first session. */
  firstSessionMs: number | null;
  /** The last error, if any. */
  error: string | null;
  /** Number of resident tiles. */
  tileCount: number;
  /** Bytes of int8 embeddings held on the CPU by resident tiles. */
  embeddingBytes: number;
  /** Bytes of float32 embeddings held on ONNX Runtime's GPU device. */
  gpuBytes: number;
};

/**
 * Runs the current {@link AnalysisTask} on every resident tile and writes the
 * results into the tiles' existing textures.
 *
 * deck.gl-raster owns which tiles are loaded; this keeps its own registry of
 * them, added from `getTileData` and removed in `onTileUnload`. A new task
 * starts a pass over the registry: run every tile, then write all the new
 * values in one synchronous step and bump `renderVersion`. Tiles are never
 * refetched and textures never replaced, so nothing blanks. Passes are
 * latest-wins: a task that arrives during a pass abandons it.
 */
export class TileAnalysis {
  private readonly tiles = new Map<string, AefTileData>();
  /** The generation each tile last failed in, so a pass does not retry it. */
  private readonly failedGeneration = new WeakMap<AefTileData, number>();
  private readonly onStatus: (status: AnalysisStatus) => void;
  private inputPath: InputPath;
  private runner: Promise<ModelRunner> | null = null;
  private task: AnalysisTask | null = null;
  private generation = 0;
  private passRunning = false;
  private passPending = false;
  private status: AnalysisStatus = {
    renderVersion: 0,
    busy: false,
    lastPass: null,
    firstSessionMs: null,
    error: null,
    tileCount: 0,
    embeddingBytes: 0,
    gpuBytes: 0,
  };

  constructor(
    inputPath: InputPath,
    onStatus: (status: AnalysisStatus) => void,
  ) {
    this.inputPath = inputPath;
    this.onStatus = onStatus;
  }

  /** The resident tile with `key`, if any. */
  getTile(key: string): AefTileData | undefined {
    return this.tiles.get(key);
  }

  /** Every resident tile. */
  residentTiles(): AefTileData[] {
    return [...this.tiles.values()];
  }

  /**
   * Run the current task on a newly loaded tile, then register it. Called
   * from `getTileData`, so the tile first draws with current values.
   */
  async addTile(tile: AefTileData, signal?: AbortSignal): Promise<void> {
    const task = this.task;
    const generation = this.generation;
    if (task && !signal?.aborted) {
      try {
        const runner = await this.getRunner();
        const output = await runner.run(task, tile);
        tile.valueTexture.writeData(output.values);
        tile.result = { model: task.model, generation };
      } catch (error) {
        // The tile still draws its RGB composite
        this.failedGeneration.set(tile, generation);
        this.reportError(error);
      }
    }
    if (signal?.aborted) {
      destroyTile(tile);
      throw signal.reason;
    }
    const previous = this.tiles.get(tile.key);
    this.tiles.set(tile.key, tile);
    if (previous && previous !== tile) {
      // deck.gl replaced the tile's content without unloading it
      void this.destroyAfterRuns([previous]);
    }
    this.update({});
    if (this.hasStaleTiles()) {
      this.schedulePass();
    }
  }

  /** Unregister a tile and free its resources. Called from `onTileUnload`. */
  removeTile(tile: AefTileData): void {
    if (this.tiles.get(tile.key) === tile) {
      this.tiles.delete(tile.key);
    }
    this.update({});
    void this.destroyAfterRuns([tile]);
  }

  /**
   * Unregister every tile and free their resources after `delayMs`.
   *
   * deck.gl does not call `onTileUnload` when a `TileLayer` is replaced, as
   * deck.gl-raster does when the selection changes, so the layer's tiles
   * would leak. The delay lets deck.gl draw without them first.
   */
  clearTiles(delayMs = 1000): void {
    const tiles = this.residentTiles();
    this.tiles.clear();
    this.update({});
    setTimeout(() => void this.destroyAfterRuns(tiles), delayMs);
  }

  /**
   * Free tiles once the runs already queued are done, since one of them may
   * read a tile's GPU buffer. Passes only queue runs for registered tiles.
   */
  private async destroyAfterRuns(tiles: AefTileData[]): Promise<void> {
    const runner = await this.runner?.catch(() => null);
    await runner?.idle();
    for (const tile of tiles) {
      destroyTile(tile);
    }
  }

  /** Set the task to run on every tile, or `null` to stop running models. */
  setTask(task: AnalysisTask | null): void {
    this.task = task;
    this.generation++;
    if (task) {
      this.schedulePass();
    }
  }

  /** Change how embeddings reach the model, and run the task again. */
  setInputPath(inputPath: InputPath): void {
    if (inputPath === this.inputPath) {
      return;
    }
    this.inputPath = inputPath;
    const previous = this.runner;
    this.runner = null;
    if (previous) {
      // Wait for the queue: a run may still use these buffers and sessions
      void previous
        .then(async (runner) => {
          await runner.idle();
          // Free only this runner's buffers: a new runner may have made its own
          for (const tile of this.tiles.values()) {
            if (tile.gpuEmbeddings?.owner === runner) {
              tile.gpuEmbeddings.destroy();
              tile.gpuEmbeddings = undefined;
            }
          }
          await runner.release();
        })
        .catch((error) => this.reportError(error));
    }
    this.setTask(this.task);
  }

  /** Load ONNX Runtime and the model for `model` ahead of the first task. */
  async prepare(model: ModelName): Promise<void> {
    const start = performance.now();
    this.update({ busy: true });
    try {
      const runner = await this.getRunner();
      await runner.prepare(model);
      if (this.status.firstSessionMs === null) {
        this.update({ firstSessionMs: performance.now() - start });
      }
    } catch (error) {
      this.reportError(error);
    } finally {
      this.update({ busy: this.passRunning });
    }
  }

  private getRunner(): Promise<ModelRunner> {
    if (!this.runner) {
      const inputPath = this.inputPath;
      const runner = loadOrt().then((ort) => new ModelRunner(ort, inputPath));
      this.runner = runner;
      runner.catch(() => {
        // Let the next call try again
        if (this.runner === runner) {
          this.runner = null;
        }
      });
    }
    return this.runner;
  }

  private schedulePass(): void {
    if (this.passRunning) {
      this.passPending = true;
      return;
    }
    this.passRunning = true;
    this.update({ busy: true });
    void this.runPasses();
  }

  private async runPasses(): Promise<void> {
    try {
      do {
        this.passPending = false;
        await this.pass();
      } while (this.passPending || this.hasStaleTiles());
    } catch (error) {
      this.reportError(error);
    } finally {
      this.passRunning = false;
      this.update({ busy: false });
    }
  }

  private hasStaleTiles(): boolean {
    if (!this.task) {
      return false;
    }
    for (const tile of this.tiles.values()) {
      if (
        tile.result?.generation !== this.generation &&
        this.failedGeneration.get(tile) !== this.generation
      ) {
        return true;
      }
    }
    return false;
  }

  /** Run the current task on every stale tile, then commit all at once. */
  private async pass(): Promise<void> {
    const task = this.task;
    const generation = this.generation;
    if (!task) {
      return;
    }
    const runner = await this.getRunner();
    const start = performance.now();
    const outputs: [AefTileData, Float32Array][] = [];
    let runMs = 0;
    for (const tile of this.residentTiles()) {
      if (generation !== this.generation) {
        return;
      }
      // Skip tiles done already, or unloaded since the pass started
      if (
        tile.result?.generation === generation ||
        this.tiles.get(tile.key) !== tile
      ) {
        continue;
      }
      try {
        const output = await runner.run(task, tile);
        outputs.push([tile, output.values]);
        runMs += output.ms;
      } catch (error) {
        this.failedGeneration.set(tile, generation);
        this.reportError(error);
      }
    }
    if (generation !== this.generation || outputs.length === 0) {
      return;
    }
    for (const [tile, values] of outputs) {
      if (this.tiles.get(tile.key) !== tile) {
        continue;
      }
      tile.valueTexture.writeData(values);
      tile.result = { model: task.model, generation };
    }
    this.update({
      renderVersion: this.status.renderVersion + 1,
      lastPass: {
        model: task.model,
        inputPath: runner.inputPath,
        tiles: outputs.length,
        ms: performance.now() - start,
        runMs,
      },
    });
  }

  private reportError(error: unknown): void {
    console.error(error);
    this.update({
      error: error instanceof Error ? error.message : String(error),
    });
  }

  private update(changes: Partial<AnalysisStatus>): void {
    let embeddingBytes = 0;
    let gpuBytes = 0;
    for (const tile of this.tiles.values()) {
      embeddingBytes += tile.embeddings.byteLength;
      gpuBytes += tile.gpuEmbeddings?.byteLength ?? 0;
    }
    this.status = {
      ...this.status,
      ...changes,
      tileCount: this.tiles.size,
      embeddingBytes,
      gpuBytes,
    };
    this.onStatus(this.status);
  }
}
