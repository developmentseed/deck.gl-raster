import type { SimpleMeshLayerProps } from "@deck.gl/mesh-layers";

/**
 * Asserts the SimpleMeshLayer-base-class per-instance transforms are all at
 * identity. The fp64 mesh-vertex precision correction (see
 * `dev-docs/specs/2026-05-19-high-zoom-precision-design.md` § "Invariant")
 * is only valid when `positions` equals the working vertex `pos` the shader
 * computes: that requires `_instanced: false`, identity instance model
 * matrix (no `getOrientation` / `getTransformMatrix` / `getScale` /
 * `getTranslation`), `sizeScale === 1`, and a constant
 * `getPosition: [0, 0, 0]`.
 *
 * Throws on any violation. Caller is expected to gate on
 * `process.env.NODE_ENV !== "production"`.
 */
export function assertFp64Invariants(props: SimpleMeshLayerProps): void {
  if (props._instanced !== false) {
    throw new Error(
      `MeshTextureLayer fp64 invariant: _instanced must be false (got ${JSON.stringify(
        props._instanced,
      )}). The fp64 mesh-vertex correction assumes a single non-instanced mesh. See dev-docs/specs/2026-05-19-high-zoom-precision-design.md.`,
    );
  }

  if (props.sizeScale !== undefined && props.sizeScale !== 1) {
    throw new Error(
      `MeshTextureLayer fp64 invariant: sizeScale must be 1 (got ${props.sizeScale}). The mesh-vertex low part is the residual of positions, not of (positions * sizeScale).`,
    );
  }

  const gp = props.getPosition;
  if (typeof gp === "function") {
    throw new Error(
      "MeshTextureLayer fp64 invariant: getPosition must be a constant [0, 0, 0] (received a function accessor). The fp64 correction assumes instancePositions is zero for every instance.",
    );
  }
  if (gp !== undefined) {
    const [x, y, z] = gp as readonly [number, number, number];
    if (x !== 0 || y !== 0 || z !== 0) {
      throw new Error(
        `MeshTextureLayer fp64 invariant: getPosition must be [0, 0, 0] (got [${x}, ${y}, ${z}]).`,
      );
    }
  }

  if (props.getOrientation !== undefined) {
    throw new Error(
      "MeshTextureLayer fp64 invariant: getOrientation must not be set — instance model matrix must remain identity.",
    );
  }
  if (props.getTransformMatrix !== undefined) {
    throw new Error(
      "MeshTextureLayer fp64 invariant: getTransformMatrix must not be set — instance model matrix must remain identity.",
    );
  }
  if (props.getScale !== undefined) {
    throw new Error(
      "MeshTextureLayer fp64 invariant: getScale must not be set — instance model matrix must remain identity.",
    );
  }
  if (props.getTranslation !== undefined) {
    throw new Error(
      "MeshTextureLayer fp64 invariant: getTranslation must not be set — instance translation must remain zero.",
    );
  }
}
