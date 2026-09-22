import {
  HttpStorage,
  IcechunkStore,
  ReadSession,
  Repository,
} from "icechunk-js";
import * as zarr from "zarrita";
import {
  BRANCH,
  REPO_URL,
  SURFACE_TEMP_PATH,
  VIRTUAL_CHUNK_CONTAINERS,
} from "./metadata.js";

/** The opened temperature array plus the fill sentinel read from its attrs. */
export interface SurfaceTempSource {
  /** The near-surface air temperature array. */
  array: zarr.Array<"float32", zarr.Readable>;
  /** Fill value, read from the array's `missing_value` attribute. */
  noDataValue: number;
}

/**
 * Open the NLDAS-3 near-surface air temperature array from the public icechunk
 * repo, with the virtual chunk container authorized so chunk reads resolve to
 * public HTTPS objects.
 *
 * The containers are only accepted by `ReadSession.open`, so we resolve the
 * branch snapshot id first, then open a session that carries them.
 */
export async function openSurfaceTemp(): Promise<SurfaceTempSource> {
  const storage = new HttpStorage(REPO_URL);
  // NLDAS-3 is a v1 icechunk repo
  const repo = await Repository.open({ storage, formatVersion: "v1" });

  const branchSession = await repo.checkoutBranch(BRANCH);
  const snapshotId = branchSession.getSnapshotId();

  const session = await ReadSession.open(storage, snapshotId, {
    virtualChunkContainers: VIRTUAL_CHUNK_CONTAINERS,
  });
  const store = await IcechunkStore.open(session);

  const node = await zarr.open(store.resolve(SURFACE_TEMP_PATH), {
    kind: "array",
  });
  if (!node.is("float32")) {
    throw new Error(
      `Expected ${SURFACE_TEMP_PATH} to be float32, got ${node.dtype}`,
    );
  }

  // Read the fill sentinel from the array's attrs rather than hard-coding it.
  const missingValue = node.attrs.missing_value;
  if (typeof missingValue !== "number") {
    throw new Error(
      `Expected ${SURFACE_TEMP_PATH} to have a numeric "missing_value" attr, ` +
        `got ${typeof missingValue}`,
    );
  }

  return { array: node, noDataValue: missingValue };
}
