import type { MeshScene } from "../src/scene/mesh.js";
import { buildMeshScene } from "../src/scene/mesh.js";
import { makeProjection } from "../src/scene/projection.js";
import { fakeImage } from "./fake-image.js";

/** The real scene, computed offline from the fake of the fixture. */
export async function fakeMeshScene(): Promise<MeshScene> {
  const projection = await makeProjection(fakeImage());
  return buildMeshScene(projection, { width: 42, height: 42 });
}
