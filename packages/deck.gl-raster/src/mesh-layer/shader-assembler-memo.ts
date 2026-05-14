import type { Device } from "@luma.gl/core";
import { ShaderAssembler } from "@luma.gl/shadertools";

type AssembledPair = ReturnType<ShaderAssembler["assembleGLSLShaderPair"]>;

type AssembleProps = Parameters<ShaderAssembler["assembleGLSLShaderPair"]>[0];

const ASSEMBLE_GLSL = "assembleGLSLShaderPair";

/**
 * Cache statistics for a memoizing shader assembler. Useful for diagnosing
 * whether the cache is actually catching the per-tile assembly load —
 * `hits` should dominate `misses` once a tile layer has rendered a few tiles.
 */
export type MemoShaderAssemblerStats = {
  /** Number of `assembleGLSLShaderPair` calls served from cache. */
  hits: number;
  /** Number of `assembleGLSLShaderPair` calls that produced a new cache entry. */
  misses: number;
  /** Distinct `(modules, vs, fs, defines)` tuples currently cached. */
  entries: number;
};

type CacheRecord = {
  cache: Map<string, AssembledPair>;
  stats: MemoShaderAssemblerStats;
  /** Cache keys for the first N misses, captured for debugging. */
  missLog: string[];
};

const perDeviceAssembler = new WeakMap<Device, ShaderAssembler>();
const perAssemblerRecord = new WeakMap<ShaderAssembler, CacheRecord>();

/** How many cache-miss keys to retain in the in-memory miss log. */
const MAX_LOGGED_MISSES = 20;

/**
 * Returns a `ShaderAssembler` whose `assembleGLSLShaderPair` results are
 * memoized per `(modules, vs, fs, defines)` tuple.
 *
 * Instances are cached per `Device` — two Deck instances on the same page get
 * independent caches, and the entries die with the device. All other
 * `ShaderAssembler` methods (hook registration, default modules, WGSL
 * assembly) delegate to {@link ShaderAssembler.getDefaultShaderAssembler}, so
 * deck.gl's globally-registered hooks remain visible.
 *
 * Within a `RasterTileLayer`, every tile sublayer passes the same modules and
 * shader source, so this collapses N regex-heavy assembly passes into one.
 */
export function getMemoizingShaderAssembler(device: Device): ShaderAssembler {
  const existing = perDeviceAssembler.get(device);
  if (existing) {
    return existing;
  }
  const assembler = createMemoizingShaderAssembler(
    ShaderAssembler.getDefaultShaderAssembler(),
  );
  perDeviceAssembler.set(device, assembler);
  return assembler;
}

/**
 * Reads the hit/miss counters for the assembler associated with a `Device`.
 * Returns `null` if no memoizing assembler has been installed for the device.
 *
 * Intended for app-level diagnostics — call from devtools to confirm the cache
 * is taking effect. A healthy mosaic-style workload should show
 * `hits >> misses` after the first few tiles have rendered.
 */
export function getMemoShaderAssemblerStats(
  device: Device,
): MemoShaderAssemblerStats | null {
  const assembler = perDeviceAssembler.get(device);
  if (!assembler) {
    return null;
  }
  const record = perAssemblerRecord.get(assembler);
  if (!record) {
    return null;
  }
  return { ...record.stats, entries: record.cache.size };
}

/**
 * Reads the most recent cache-miss keys for a device's memoizing assembler.
 * Use this to find out what's varying when the cache misses more than
 * expected — the key encodes `modules|defines|vs|fs`, so a diff between two
 * miss keys identifies the perturbing input.
 */
export function getMemoShaderAssemblerMissLog(
  device: Device,
): readonly string[] {
  const assembler = perDeviceAssembler.get(device);
  if (!assembler) {
    return [];
  }
  const record = perAssemblerRecord.get(assembler);
  if (!record) {
    return [];
  }
  return record.missLog;
}

/**
 * Reads stats from the assembler directly. Exposed for testing —
 * production callers should use {@link getMemoShaderAssemblerStats}.
 */
export function readAssemblerStats(
  assembler: ShaderAssembler,
): MemoShaderAssemblerStats | null {
  const record = perAssemblerRecord.get(assembler);
  if (!record) {
    return null;
  }
  return { ...record.stats, entries: record.cache.size };
}

/**
 * Wraps a `ShaderAssembler` so that repeated calls to `assembleGLSLShaderPair`
 * with the same inputs return the same cached result. Exposed for testing —
 * production callers should use {@link getMemoizingShaderAssembler}.
 */
export function createMemoizingShaderAssembler(
  inner: ShaderAssembler,
): ShaderAssembler {
  const cache = new Map<string, AssembledPair>();
  const stats: MemoShaderAssemblerStats = { hits: 0, misses: 0, entries: 0 };
  const missLog: string[] = [];

  const assembler = new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop !== ASSEMBLE_GLSL) {
        return Reflect.get(target, prop, receiver);
      }
      return (props: AssembleProps): AssembledPair => {
        const key = computeCacheKey(props);
        const hit = cache.get(key);
        if (hit) {
          stats.hits++;
          return hit;
        }
        stats.misses++;
        if (missLog.length < MAX_LOGGED_MISSES) {
          missLog.push(key);
        }
        const result = target.assembleGLSLShaderPair.call(target, props);
        cache.set(key, result);
        stats.entries = cache.size;
        return result;
      };
    },
  });

  perAssemblerRecord.set(assembler, { cache, stats, missLog });
  return assembler;
}

function computeCacheKey(props: AssembleProps): string {
  const moduleKey = (props.modules ?? [])
    .map((module) => module.name)
    .join("|");
  const definesKey = props.defines ? stableStringify(props.defines) : "";
  return `${moduleKey}::${definesKey}::${props.vs ?? ""}::${props.fs ?? ""}`;
}

function stableStringify(value: Record<string, unknown>): string {
  const keys = Object.keys(value).sort();
  const parts: string[] = [];
  for (const key of keys) {
    parts.push(`${key}=${String(value[key])}`);
  }
  return parts.join(",");
}
