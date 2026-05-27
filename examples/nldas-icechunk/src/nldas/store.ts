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

/**
 * Open the NLDAS-3 near-surface air temperature array from the public icechunk
 * repo, with the virtual chunk container authorized so chunk reads resolve to
 * public HTTPS objects.
 *
 * The container map is only accepted by `ReadSession.open`, so we resolve the
 * branch snapshot id first, then open a session that carries it.
 */
export async function openSurfaceTemp(): Promise<
  zarr.Array<"float32", zarr.Readable>
> {
  const storage = new HttpStorage(REPO_URL);
  const repo = await Repository.open({ storage });

  const branchSession = await repo.checkoutBranch(BRANCH);
  const snapshotId = branchSession.getSnapshotId();
  const snapshotBytes =
    snapshotId instanceof Uint8Array
      ? snapshotId
      : new Uint8Array(snapshotId as ArrayLike<number>);

  const session = await ReadSession.open(storage, snapshotBytes, {
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
  return node;
}
